import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, Index } from 'typeorm';
import { Team } from './team.entity';
import { TestRun } from './test-run.entity';
import { PyroscopeInstance } from './pyroscope-instance.entity';

@Entity('systems_under_test')
@Index('idx_systems_under_test_name', ['name'])
@Index('idx_systems_under_test_team_id', ['team_id'])
@Index('idx_systems_under_test_organization_id', ['organization_id'])
@Index('idx_systems_under_test_created_by', ['created_by'])
export class SystemUnderTest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  team_id?: string;

  @Column({ type: 'uuid', nullable: true })
  organization_id?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by?: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  tracing_service?: string;

  @Column({ type: 'uuid', nullable: true, name: 'pyroscope_instance_id' })
  pyroscope_instance_id?: string;

  @Column({ type: 'jsonb', nullable: true, default: '[]', name: 'pyroscope_configurations' })
  pyroscope_configurations?: Array<{ application: string; profiler: string }>;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @ManyToOne(() => Team, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'team_id' })
  team?: Team;

  @ManyToOne(() => PyroscopeInstance)
  @JoinColumn({ name: 'pyroscope_instance_id' })
  pyroscopeInstance?: PyroscopeInstance;

  @OneToMany(() => TestRun, testRun => testRun.systemUnderTest)
  testRuns?: TestRun[];
}