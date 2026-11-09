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
    'read_only',
    'profile_id',
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

  /**
   * The fields this template forces onto a `ds_compare_config` row, keyed as in the provisioning
   * YAML (`absThreshold`, `percentageThreshold`, `higherIsBetter`, ...). A key that is present is
   * named, explicit `null` included; an absent key leaves the row's own value alone.
   * `higherIsBetter` presence is read from here first. Provisioning writes `higher_is_better` from it;
   * the resolver also counts a set column when the key is missing, which is what migration 1822's
   * backfill copies into the overrides and what keeps a direction when an API older than 1822
   * rewrites this column without the key. A writer must set both, never only the column.
   */
  @Column({ type: 'jsonb', nullable: true })
  config_overrides?: Record<string, unknown>;

  /**
   * Owned by the provisioning file: written and pruned from YAML, not editable in the UI. Nullable
   * on purpose (an older SUT bundle imports NULL); NULL means false.
   */
  @Column({ type: 'boolean', nullable: true, default: false })
  read_only?: boolean | null;

  /**
   * A profile template applies only to runs whose tags match this profile (migration 1823). Its
   * scope is the profile alone: `organization_id` holds a copy of the profile's organization for the
   * audit log, and is neither part of the key nor read for selection or access, which go through the
   * profile. ON DELETE CASCADE: deleting a profile deletes its templates.
   */
  @Column({ type: 'uuid', nullable: true })
  profile_id?: string | null;

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
