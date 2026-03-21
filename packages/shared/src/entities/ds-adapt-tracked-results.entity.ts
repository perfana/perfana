import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApplicationDashboard } from './application-dashboard.entity';

@Entity('ds_adapt_tracked_results')
export class DsAdaptTrackedResults {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  test_run_id!: string;

  @Column({ type: 'varchar' })
  control_group_id!: string;

  @Column({ type: 'varchar' })
  tracked_test_run_id!: string;

  @Column({ type: 'varchar', nullable: true })
  tracked_difference_id?: string;

  @Column({ type: 'uuid' })
  application_dashboard_id!: string;

  @Column({ type: 'integer' })
  panel_id!: number;

  @Column({ type: 'varchar' })
  metric_name!: string;

  @Column({ type: 'varchar', nullable: true })
  dashboard_uid?: string;

  @Column({ type: 'varchar', nullable: true })
  dashboard_label?: string;

  @Column({ type: 'varchar', nullable: true })
  panel_title?: string;

  @Column({ type: 'varchar', nullable: true })
  unit?: string;

  @Column({ type: 'text', array: true, nullable: true })
  benchmark_ids?: string[];

  @Column({ type: 'timestamptz' })
  test_run_start!: Date;

  @Column({ type: 'uuid', nullable: true })
  organization_id?: string;

  @Column({ type: 'uuid', nullable: true })
  team_id?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by?: string;

  @UpdateDateColumn()
  updated_at!: Date;

  @Column({ type: 'jsonb', nullable: true })
  mean?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  median?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  min_value?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  max_value?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  std_dev?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  q10?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  q25?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  q75?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  q90?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  q95?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  q99?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  iqr?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  idr?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  count?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  n_missing?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  n_non_zero?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  pct_missing?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  is_constant?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  all_missing?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  last_value?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  exists_flags?: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  uses_default_value!: boolean;

  @Column({ type: 'decimal', nullable: true })
  default_value?: number;

  @Column({ type: 'jsonb', nullable: true })
  compare_config?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  metric_classification?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  statistic?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  conditions?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  thresholds?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  checks?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  conclusion?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  tracked_conclusion?: Record<string, any>;

  @ManyToOne(() => ApplicationDashboard)
  @JoinColumn({ name: 'application_dashboard_id' })
  application_dashboard?: ApplicationDashboard;
}