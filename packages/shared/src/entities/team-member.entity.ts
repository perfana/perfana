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
