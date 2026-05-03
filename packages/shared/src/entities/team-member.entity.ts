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
import { Team } from './team.entity';

@Entity('team_members')
@Unique(['team_id', 'user_id'])
@Index(['user_id'])
@Index(['team_id', 'user_id'])
export class TeamMember {
  // Phase 5a audit logging — membership rows record who was added/removed
  // (`user_id`), which roles they hold (`roles`), and the parent team
  // (`team_id`). TeamMember has no `organization_id` column itself; the
  // audit envelope is set via `organizationIdOverride: team.organization_id`
  // at the call site so org-admin scoped queries see these rows.
  static auditableFields = ['user_id', 'roles', 'team_id'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  team_id!: string;

  @Column('varchar', { length: 255, comment: 'Keycloak user sub or api-key:{id}' })
  user_id!: string;

  @Column('jsonb', {
    default: '[]',
    comment: 'Team-level roles: team-admin, team-member, team-viewer',
  })
  roles!: string[];

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at!: Date;

  @ManyToOne(() => Team, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team!: Team;
}
