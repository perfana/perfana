import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApplicationDashboard } from './application-dashboard.entity';
import { MetricsSource } from './metrics-source.entity';
import { SystemUnderTest } from './system-under-test.entity';

@Entity('ds_compare_config')
export class DsCompareConfig {
  // Phase 5a — fields surfaced in audit-log diffs. DsCompareConfig drives
  // ADAPT regression detection per (SUT, env, workload, dashboard, panel,
  // metric); changes here retroactively change anomaly verdicts. Ownership /
  // org / team and timestamps excluded (emitted via audit-row columns), and
  // `config_hash` / `last_modified_at` are derived caches.
  static auditableFields = [
    'system_under_test_id',
    'test_environment',
    'workload',
    'application_dashboard_id',
    'panel_id',
    'metric_name',
    'metrics_source_id',
    'config_data',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  application_dashboard_id!: string;

  @Column({ type: 'integer' })
  panel_id!: number;

  @Column({ type: 'jsonb' })
  config_data!: Record<string, unknown>;

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

  @Column({ type: 'varchar', length: 255, nullable: true })
  metric_name?: string;

  @Column({ type: 'uuid' })
  system_under_test_id!: string;

  @Column({ type: 'varchar', length: 255 })
  test_environment!: string;

  @Column({ type: 'varchar', length: 255 })
  workload!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  config_hash?: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  last_modified_at!: Date;

  @Column({ type: 'uuid', nullable: true })
  metrics_source_id?: string;

  @ManyToOne(() => ApplicationDashboard, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_dashboard_id' })
  application_dashboard?: ApplicationDashboard;

  @ManyToOne(() => MetricsSource)
  @JoinColumn({ name: 'metrics_source_id' })
  metrics_source?: MetricsSource;

  @ManyToOne(() => SystemUnderTest)
  @JoinColumn({ name: 'system_under_test_id' })
  system_under_test?: SystemUnderTest;
}