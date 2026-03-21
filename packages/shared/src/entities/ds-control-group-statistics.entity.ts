import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApplicationDashboard } from './application-dashboard.entity';

@Entity('ds_control_group_statistics')
export class DsControlGroupStatistics {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  control_group_id!: string;

  @Column({ type: 'uuid' })
  application_dashboard_id!: string;

  @Column({ type: 'integer' })
  panel_id!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  metric_name?: string;

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

  @Column({ type: 'double precision', nullable: true })
  last_value?: number;

  @Column({ type: 'integer' })
  count!: number;

  @Column({ type: 'integer', default: 0 })
  n_missing!: number;

  @Column({ type: 'integer', default: 0 })
  n_non_zero!: number;

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

  @Column({ type: 'boolean', default: false })
  is_constant!: boolean;

  @Column({ type: 'boolean', default: false })
  all_missing!: boolean;

  @Column({ type: 'double precision', nullable: true })
  pct_missing?: number;

  @Column({ type: 'double precision', nullable: true })
  iqr?: number;

  @Column({ type: 'double precision', nullable: true })
  idr?: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  unit?: string;

  @Column({ type: 'double precision', nullable: true })
  timestep?: number;

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

  @CreateDateColumn()
  created_at!: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  test_run_id?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_uid?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  dashboard_label?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  panel_title?: string;

  @Column({ type: 'varchar', array: true, nullable: true })
  benchmark_ids?: string[];

  @ManyToOne(() => ApplicationDashboard)
  @JoinColumn({ name: 'application_dashboard_id' })
  application_dashboard?: ApplicationDashboard;
}