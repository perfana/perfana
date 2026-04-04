import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SystemUnderTest } from './system-under-test.entity';

@Entity('scaling_sessions')
@Index('idx_scaling_sessions_system_env_workload', ['system_under_test_id', 'test_environment', 'workload'])
@Index('idx_scaling_sessions_organization_id', ['organization_id'])
@Index('idx_scaling_sessions_status', ['status'])
export class ScalingSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  system_under_test_id!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255 })
  test_environment!: string;

  @Column({ type: 'varchar', length: 255 })
  workload!: string;

  @Column({ name: 'baseline_test_run_id', type: 'varchar', length: 255, nullable: true })
  baseline_test_run_id?: string;

  @Column({ name: 'target_load', type: 'varchar', length: 255, nullable: true })
  target_load?: string;

  @Column({ name: 'linked_benchmark_ids', type: 'uuid', array: true, default: '{}' })
  linked_benchmark_ids!: string[];

  @Column({ name: 'run_comments', type: 'jsonb', default: '{}' })
  run_comments!: Record<string, string>;

  @Column({ type: 'varchar', length: 50, default: 'active' })
  status!: string;

  // RBAC ownership
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organization_id?: string;

  @Column({ name: 'team_id', type: 'uuid', nullable: true })
  team_id?: string;

  @Column({ name: 'created_by', type: 'varchar', length: 255, nullable: true })
  created_by?: string;

  @Column({ name: 'updated_by', type: 'varchar', length: 255, nullable: true })
  updated_by?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone', default: () => 'now()' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone', default: () => 'now()' })
  updated_at!: Date;

  @ManyToOne(() => SystemUnderTest)
  @JoinColumn({ name: 'system_under_test_id' })
  system_under_test?: SystemUnderTest;
}
