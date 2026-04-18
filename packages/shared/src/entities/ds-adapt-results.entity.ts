import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApplicationDashboard } from './application-dashboard.entity';
import { MetricsSource } from './metrics-source.entity';

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
  mean?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  min?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  max?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  std?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  median?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  q10?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  q25?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  q75?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  q90?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  q95?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  q99?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  last_value?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  n?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  n_missing?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  n_non_zero?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  iqr?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  idr?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  is_constant?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  all_missing?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  exists_data?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  pct_missing?: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  compare_config!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  metric_classification?: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  statistic!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  conditions!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  thresholds!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  checks!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  conclusion!: Record<string, unknown>;

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

  @Column({ type: 'uuid', nullable: true })
  metrics_source_id?: string;

  @ManyToOne(() => ApplicationDashboard)
  @JoinColumn({ name: 'application_dashboard_id' })
  application_dashboard?: ApplicationDashboard;

  @ManyToOne(() => MetricsSource)
  @JoinColumn({ name: 'metrics_source_id' })
  metrics_source?: MetricsSource;
}