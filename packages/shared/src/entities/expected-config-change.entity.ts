import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { SystemUnderTest } from './system-under-test.entity';

@Entity('expected_config_changes')
@Unique(['system_under_test_id', 'test_environment', 'workload', 'config_key'])
export class ExpectedConfigChange {
  // Phase 5a — fields surfaced in audit-log diffs. ExpectedConfigChange is a
  // user-defined waiver suppressing config-diff alerts for a specific key on
  // a (SUT, env, workload). Ownership / org / team and timestamps excluded
  // (emitted via audit-row columns).
  static auditableFields = [
    'system_under_test_id',
    'test_environment',
    'workload',
    'config_key',
    'expected_value',
    'description',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  system_under_test_id!: string;

  @Column({ type: 'varchar', length: 255 })
  test_environment!: string;

  @Column({ type: 'varchar', length: 255 })
  workload!: string;

  @Column({ type: 'varchar', length: 500 })
  config_key!: string;

  @Column({ type: 'text', nullable: true })
  expected_value?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

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
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  @ManyToOne(() => SystemUnderTest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'system_under_test_id' })
  system_under_test?: SystemUnderTest;
}