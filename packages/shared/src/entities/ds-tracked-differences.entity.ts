import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApplicationDashboard } from './application-dashboard.entity';
import { Benchmark } from './benchmark.entity';
import { MetricsSource } from './metrics-source.entity';

@Entity('ds_tracked_differences')
export class DsTrackedDifferences {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  test_run_id!: string;

  @Column({ type: 'uuid' })
  application_dashboard_id!: string;

  @Column({ type: 'integer' })
  panel_id!: number;

  @Column({ type: 'uuid', nullable: true })
  benchmark_id?: string;

  @Column({ type: 'jsonb' })
  difference_data!: Record<string, unknown>;

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