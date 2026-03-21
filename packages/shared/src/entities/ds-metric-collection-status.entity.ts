import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TestRun } from './test-run.entity';

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface FailedRange extends TimeRange {
  attempts: number;
  lastError: string;
}

@Entity('ds_metric_collection_status')
@Index(['test_run_id', 'source_type', 'source_id'], { unique: true })
export class DsMetricCollectionStatus {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  test_run_id!: string;

  @Column({ type: 'varchar', length: 50 })
  source_type!: string; // 'grafana' | 'dynatrace' | 'performance_test'

  @Column({ type: 'varchar', length: 255, nullable: true })
  source_id?: string; // grafana_instance_id, dynatrace_config_id, or null for perf_test

  @Column('jsonb', { default: '[]' })
  collected_ranges!: TimeRange[];

  @Column('jsonb', { default: '[]' })
  failed_ranges!: FailedRange[];

  @Column({ type: 'timestamp with time zone', nullable: true })
  last_collected_at?: Date;

  @Column({ type: 'boolean', default: false })
  is_complete!: boolean;

  @Column({ type: 'integer', default: 0 })
  total_data_points!: number;

  @Column({ type: 'uuid', nullable: true })
  organization_id?: string;

  @Column({ type: 'uuid', nullable: true })
  team_id?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by?: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at!: Date;

  // Relationship to TestRun
  @ManyToOne(() => TestRun)
  @JoinColumn({ name: 'test_run_id', referencedColumnName: 'testRunId' })
  testRun?: TestRun;
}
