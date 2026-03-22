import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApplicationDashboard } from './application-dashboard.entity';
import { Benchmark } from './benchmark.entity';
import { MetricsSource } from './metrics-source.entity';

@Entity('ds_metric_statistics')
export class DsMetricStatistics {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  test_run_id!: string;

  @Column({ type: 'uuid' })
  application_dashboard_id!: string;

  @Column({ type: 'integer' })
  panel_id!: number;

  @Column({ type: 'uuid', nullable: true })
  benchmark_id?: string;

  @Column({ type: 'bigint', nullable: true })
  count?: number;

  @Column({ type: 'double precision', nullable: true })
  mean?: number;

  @Column({ type: 'double precision', nullable: true })
  median?: number;

  @Column({ type: 'double precision', nullable: true })
  min_value?: number;

  @Column({ type: 'double precision', nullable: true })
  max_value?: number;

  @Column({ type: 'double precision', nullable: true })
  std_dev?: number;

  @Column({ type: 'jsonb', nullable: true })
  percentiles?: Record<string, any>;

  @Column({ type: 'double precision', nullable: true })
  iqr?: number;

  @Column({ type: 'double precision', nullable: true })
  idr?: number;

  @Column({ type: 'double precision', nullable: true })
  missing_percentage?: number;

  @Column({ type: 'boolean', nullable: true })
  constant_value?: boolean;

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

  @Column({ type: 'varchar', length: 255, nullable: true })
  metric_name?: string;

  @Column({ type: 'timestamptz', nullable: true })
  test_run_start?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_uid?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_label?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  panel_title?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  unit?: string;

  @Column({ type: 'double precision', nullable: true })
  q10?: number;

  @Column({ type: 'double precision', nullable: true })
  q25?: number;

  @Column({ type: 'double precision', nullable: true })
  q75?: number;

  @Column({ type: 'double precision', nullable: true })
  q90?: number;

  @Column({ type: 'double precision', nullable: true })
  q95?: number;

  @Column({ type: 'double precision', nullable: true })
  q99?: number;

  @Column({ type: 'boolean', nullable: true })
  is_constant?: boolean;

  @Column({ type: 'boolean', nullable: true })
  all_missing?: boolean;

  @Column({ type: 'double precision', nullable: true })
  pct_missing?: number;

  @Column({ type: 'double precision', nullable: true })
  last_value?: number;

  @Column({ type: 'integer', nullable: true })
  n_missing?: number;

  @Column({ type: 'integer', nullable: true })
  n_non_zero?: number;

  @Column({ type: 'uuid', nullable: true })
  metrics_source_id?: string;

  @ManyToOne(() => ApplicationDashboard)
  @JoinColumn({ name: 'application_dashboard_id' })
  application_dashboard?: ApplicationDashboard;

  @ManyToOne(() => MetricsSource)
  @JoinColumn({ name: 'metrics_source_id' })
  metrics_source?: MetricsSource;

  @ManyToOne(() => Benchmark, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'benchmark_id' })
  benchmark?: Benchmark;
}