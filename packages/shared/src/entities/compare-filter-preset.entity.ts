import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { ApplicationDashboard } from './application-dashboard.entity';
import { MetricsSource } from './metrics-source.entity';

@Entity('compare_filter_presets')
@Index(['name'])
@Index(['presetType'])
@Index(['isGlobal'])
@Index(['createdBy'])
@Index(['applicationDashboardId'], { where: 'application_dashboard_id IS NOT NULL' })
@Index(['createdForTestRunId'], { where: 'created_for_test_run_id IS NOT NULL' })
export class CompareFilterPreset {
  // Phase 5a — fields surfaced in audit-log diffs. Ownership / org / team
  // columns and timestamps are intentionally excluded; they are emitted via
  // dedicated columns on the audit row.
  static auditableFields = [
    'name',
    'description',
    'presetType',
    'seriesSearchText',
    'showPercentiles',
    'panelId',
    'panelTitle',
    'baselineTestRunId',
    'applicationDashboardId',
    'metricsSourceId',
    'source',
    'dashboardLabel',
    'seriesConfig',
    'createdForTestRunId',
    'isGlobal',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'preset_type', type: 'varchar', length: 20, default: 'generic' })
  presetType!: string;

  @Column({ name: 'series_search_text', type: 'varchar', length: 255, nullable: true })
  seriesSearchText?: string;

  @Column({ name: 'show_percentiles', type: 'boolean', default: false })
  showPercentiles!: boolean;

  @Column({ name: 'panel_id', type: 'integer', nullable: true })
  panelId?: number;

  @Column({ name: 'panel_title', type: 'varchar', length: 255, nullable: true })
  panelTitle?: string;

  @Column({ name: 'baseline_test_run_id', type: 'varchar', length: 255, nullable: true })
  baselineTestRunId?: string;

  @Column({ name: 'is_global', type: 'boolean', default: false })
  isGlobal!: boolean;

  @Column({ name: 'application_dashboard_id', type: 'uuid', nullable: true })
  applicationDashboardId?: string;

  @Column({ name: 'metrics_source_id', type: 'uuid', nullable: true })
  metricsSourceId?: string;

  @Column({ name: 'source', type: 'varchar', length: 20, nullable: true, default: 'grafana' })
  source?: string;

  @Column({ name: 'dashboard_label', type: 'varchar', length: 255, nullable: true })
  dashboardLabel?: string;

  @Column({ name: 'series_config', type: 'jsonb', nullable: true })
  seriesConfig?: Record<string, unknown>[];

  @Column({ name: 'created_for_test_run_id', type: 'varchar', length: 255, nullable: true })
  createdForTestRunId?: string;

  // Ownership tracking (RBAC Phase 2)
  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId?: string;

  @Column({ name: 'created_by', type: 'varchar', length: 255, nullable: true })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'updated_by' })
  updatedBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // Relationships
  @ManyToOne(() => ApplicationDashboard, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'application_dashboard_id' })
  applicationDashboard?: ApplicationDashboard;

  @ManyToOne(() => MetricsSource, { nullable: true })
  @JoinColumn({ name: 'metrics_source_id' })
  metricsSource?: MetricsSource;
}