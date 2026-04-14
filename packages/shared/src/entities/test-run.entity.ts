import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { SystemUnderTest } from './system-under-test.entity';
import { TestRunConfiguration } from './test-run-configuration.entity';
import {
  TestRunStatus,
  ConsolidatedResult,
  AdaptConfig,
  TestRunVariables,
  DeepLinksCollection
} from '../types';

@Entity('test_runs')
@Index('idx_test_runs_test_run_id', ['testRunId'])
@Index('idx_test_runs_system_under_test_id', ['systemUnderTestId'])
@Index('idx_test_runs_test_environment', ['testEnvironment'])
@Index('idx_test_runs_workload', ['workload'])
@Index('idx_test_runs_completed', ['completed'])
@Index('idx_test_runs_is_stale', ['isStale'])
@Index('idx_test_runs_completed_updated', ['completed', 'updatedAt'])
@Index('idx_test_runs_created_at', ['createdAt'])
@Index('idx_test_runs_system_env_workload', ['systemUnderTestId', 'testEnvironment', 'workload'])
@Index('idx_test_runs_system_env_workload_created', ['systemUnderTestId', 'testEnvironment', 'workload', 'createdAt'])
export class TestRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255 })
  testEnvironment!: string;

  @Column({ type: 'varchar', length: 255 })
  workload!: string;

  @Column({ name: 'test_run_id', type: 'varchar', length: 255, unique: true })
  testRunId!: string;

  @Column({ name: 'start_time', type: 'timestamp with time zone', nullable: true })
  startTime?: Date;

  @Column({ name: 'end_time', type: 'timestamp with time zone', nullable: true })
  endTime?: Date;

  @Column({ type: 'integer', nullable: true })
  duration?: number;

  @Column({ name: 'planned_duration', type: 'integer', nullable: true })
  plannedDuration?: number;

  @Column({ name: 'ramp_up', type: 'integer', nullable: true })
  analysisStartOffset?: number;

  @Column({ type: 'boolean', nullable: true, default: false })
  completed?: boolean;

  @Column({ type: 'boolean', nullable: true, default: false })
  abort?: boolean;

  @Column({ name: 'abort_message', type: 'text', nullable: true })
  abortMessage?: string;

  @Column({ name: 'is_stale', type: 'boolean', nullable: true, default: false })
  isStale?: boolean;

  @Column({ name: 'stale_detected_at', type: 'timestamp with time zone', nullable: true })
  staleDetectedAt?: Date;

  @Column('jsonb', { nullable: true })
  status?: TestRunStatus;

  @Column('jsonb', { name: 'consolidated_result', nullable: true })
  consolidatedResult?: ConsolidatedResult;

  @Column('text', { array: true, nullable: true })
  annotations?: string[];

  @Column('text', { array: true, nullable: true })
  tags?: string[];

  @Column({ name: 'application_release', type: 'varchar', length: 255, nullable: true })
  applicationRelease?: string;

  @Column({ name: 'ci_build_results_url', type: 'varchar', length: 255, nullable: true })
  ciBuildResultsUrl?: string;

  @Column({ name: 'expires', type: 'timestamp with time zone', nullable: true })
  expires?: Date;

  @Column({ type: 'boolean', nullable: true, default: false })
  expired?: boolean;

  @Column({ type: 'boolean', nullable: true, default: true })
  valid?: boolean;

  @Column('text', { array: true, name: 'reasons_not_valid', nullable: true })
  reasonsNotValid?: string[];

  @Column('text', { array: true, name: 'data_warnings', nullable: true })
  dataWarnings?: string[];

  @Column('jsonb', { name: 'adapt_config', nullable: true })
  adaptConfig?: AdaptConfig;

  @Column('jsonb', { nullable: true })
  variables?: TestRunVariables;

  @Column('jsonb', { name: 'deep_links', nullable: true })
  deepLinks?: DeepLinksCollection;

  @Column({ name: 'deletion_status', type: 'varchar', length: 20, nullable: true, default: null })
  deletionStatus?: string | null;

  // Ownership tracking (added for multi-tenant support)
  @Column({ type: 'uuid', nullable: true, name: 'organization_id' })
  organizationId?: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'created_by' })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'updated_by' })
  updatedBy?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone', default: () => 'now()' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone', default: () => 'now()' })
  updatedAt!: Date;

  // Relationships
  @ManyToOne(() => SystemUnderTest)
  @JoinColumn({ name: 'system_under_test_id' })
  systemUnderTest?: SystemUnderTest;

  @OneToMany(() => TestRunConfiguration, config => config.testRun)
  configurations!: TestRunConfiguration[];
}