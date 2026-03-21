import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApplicationDashboard } from './application-dashboard.entity';

@Entity('ds_adapt_results')
export class DsAdaptResults {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  test_run_id!: string;

  @Column({ type: 'varchar', length: 255 })
  control_group_id!: string;

  @Column({ type: 'uuid' })
  application_dashboard_id!: string;

  @Column({ type: 'integer' })
  panel_id!: number;

  @Column({ type: 'varchar', length: 500 })
  metric_name!: string;

  @Column({ type: 'varchar', length: 255 })
  dashboard_uid!: string;

  @Column({ type: 'varchar', length: 500 })
  dashboard_label!: string;

  @Column({ type: 'varchar', length: 500 })
  panel_title!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  unit?: string;

  @Column({ type: 'timestamptz' })
  test_run_start!: Date;

  @Column({ type: 'text', array: true, nullable: true })
  benchmark_ids?: string[];

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
  min?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  max?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  std?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  median?: Record<string, any>;

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
  last_value?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  n?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  n_missing?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  n_non_zero?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  iqr?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  idr?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  is_constant?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  all_missing?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  exists_data?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  pct_missing?: Record<string, any>;

  @Column({ type: 'jsonb' })
  compare_config!: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  metric_classification?: Record<string, any>;

  @Column({ type: 'jsonb' })
  statistic!: Record<string, any>;

  @Column({ type: 'jsonb' })
  conditions!: Record<string, any>;

  @Column({ type: 'jsonb' })
  thresholds!: Record<string, any>;

  @Column({ type: 'jsonb' })
  checks!: Record<string, any>;

  @Column({ type: 'jsonb' })
  conclusion!: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  uses_default_value!: boolean;

  @Column({ type: 'decimal', nullable: true })
  default_value?: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  config_hash_used?: string;

  @Column({ type: 'boolean', default: false })
  is_stale!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  stale_reason?: string;

  @Column({ type: 'timestamptz', nullable: true })
  stale_at?: Date;

  @ManyToOne(() => ApplicationDashboard)
  @JoinColumn({ name: 'application_dashboard_id' })
  application_dashboard?: ApplicationDashboard;
}