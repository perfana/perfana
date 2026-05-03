import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { SystemUnderTest } from './system-under-test.entity';
import { ApplicationDashboard } from './application-dashboard.entity';
import { MetricsSource } from './metrics-source.entity';

@Entity('provisioned_template_ds_compare_configs')
export class ProvisionedTemplateDsCompareConfig {
  // Phase 5a — fields surfaced in audit-log diffs. Templates are golden-path
  // metric classifications applied on test-run completion to seed
  // DsCompareConfig rows; template edits propagate to future ADAPT runs.
  // Ownership / org / team and timestamps excluded (emitted via audit-row
  // columns).
  static auditableFields = [
    'system_under_test_id',
    'test_environment',
    'workload',
    'dashboard_uid',
    'dashboard_label',
    'application_dashboard_id',
    'metrics_source_id',
    'panel_id',
    'panel_title',
    'metric_name',
    'regex',
    'higher_is_better',
    'metric_classification',
    'config_overrides',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  system_under_test_id?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  test_environment?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  workload?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_uid?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_label?: string;

  @Column({ type: 'uuid', nullable: true })
  application_dashboard_id?: string;

  @Column({ type: 'uuid', nullable: true })
  metrics_source_id?: string;

  @Column({ type: 'integer', nullable: true })
  panel_id?: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  panel_title?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  metric_name?: string;

  @Column({ type: 'boolean', default: false })
  regex!: boolean;

  @Column({ type: 'boolean', nullable: true })
  higher_is_better?: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  metric_classification?: string;

  @Column({ type: 'jsonb', nullable: true })
  config_overrides?: Record<string, unknown>;

  @Column({ type: 'uuid', nullable: true })
  organization_id?: string;

  @Column({ type: 'uuid', nullable: true })
  team_id?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by?: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at!: Date;

  @ManyToOne(() => SystemUnderTest)
  @JoinColumn({ name: 'system_under_test_id' })
  system_under_test?: SystemUnderTest;

  @ManyToOne(() => ApplicationDashboard)
  @JoinColumn({ name: 'application_dashboard_id' })
  application_dashboard?: ApplicationDashboard;

  @ManyToOne(() => MetricsSource)
  @JoinColumn({ name: 'metrics_source_id' })
  metrics_source?: MetricsSource;
}
