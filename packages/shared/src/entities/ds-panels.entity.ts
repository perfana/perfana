import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApplicationDashboard } from './application-dashboard.entity';

@Entity('ds_panels')
export class DsPanels {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  test_run_id!: string;

  @Column({ type: 'uuid' })
  application_dashboard_id!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_uid?: string;

  @Column({ type: 'integer', nullable: true })
  panel_id?: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  panel_title?: string;

  @Column({ type: 'varchar', nullable: true })
  dashboard_label?: string;

  @Column({ type: 'text', array: true, nullable: true })
  benchmark_ids?: string[];

  @Column({ type: 'jsonb', nullable: true })
  panel?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  query_variables?: Record<string, any>;

  @Column({ type: 'varchar', nullable: true })
  datasource_type?: string;

  @Column({ type: 'jsonb', nullable: true })
  requests?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  errors?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  warnings?: Record<string, any>;

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