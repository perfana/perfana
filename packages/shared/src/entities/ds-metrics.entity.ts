import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApplicationDashboard } from './application-dashboard.entity';
import { MetricsSource } from './metrics-source.entity';

@Entity('ds_metrics')
export class DsMetrics {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  test_run_id!: string;

  @PrimaryColumn('uuid')
  application_dashboard_id!: string;

  @PrimaryColumn({ type: 'varchar', length: 255 })
  dashboard_uid!: string;

  @PrimaryColumn('int')
  panel_id!: number;

  @PrimaryColumn('timestamp with time zone')
  time!: Date;

  @PrimaryColumn({ type: 'varchar', length: 255 })
  metric_name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  panel_title?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_label?: string;

  @Column({ type: 'text', array: true, nullable: true })
  benchmark_ids?: string[];

  @Column({ type: 'jsonb', nullable: true })
  errors?: Record<string, any>;

  @Column({ type: 'double precision', nullable: true })
  timestep?: number;

  @Column({ type: 'boolean', nullable: true })
  ramp_up?: boolean;

  @Column({ type: 'double precision', nullable: true })
  value?: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  unit?: string;

  @Column({ type: 'uuid', nullable: true })
  organization_id?: string;

  @Column({ type: 'uuid', nullable: true })
  team_id?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by?: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @Column({ type: 'uuid', nullable: true })
  metrics_source_id?: string;

  @ManyToOne(() => ApplicationDashboard)
  @JoinColumn({ name: 'application_dashboard_id' })
  application_dashboard!: ApplicationDashboard;

  @ManyToOne(() => MetricsSource)
  @JoinColumn({ name: 'metrics_source_id' })
  metrics_source?: MetricsSource;
}