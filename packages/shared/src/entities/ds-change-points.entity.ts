import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApplicationDashboard } from './application-dashboard.entity';

@Entity('ds_change_points')
export class DsChangePoints {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  system_under_test_id!: string;

  @Column({ type: 'varchar', length: 255 })
  workload!: string;

  @Column({ type: 'varchar', length: 255 })
  test_environment!: string;

  @Column({ type: 'varchar', length: 255 })
  test_run_id!: string;

  @Column({ type: 'uuid', nullable: true })
  application_dashboard_id?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  panel_title?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_label?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_uid?: string;

  @Column({ type: 'int', nullable: true })
  panel_id?: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  metric_name?: string;

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

  @ManyToOne(() => ApplicationDashboard)
  @JoinColumn({ name: 'application_dashboard_id' })
  application_dashboard?: ApplicationDashboard;
}