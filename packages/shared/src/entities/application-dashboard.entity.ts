import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique, ManyToOne, JoinColumn } from 'typeorm';
import { SystemUnderTest } from './system-under-test.entity';
import { GrafanaInstance } from './grafana-instance.entity';
import { GrafanaDashboard } from './grafana-dashboard.entity';

@Entity('application_dashboards')
@Unique('uq_application_dashboards_unique', [
  'systemUnderTestId',
  'testEnvironment',
  'grafanaInstanceId',
  'dashboardUid',
  'dashboardLabel'
])
@Index(['systemUnderTestId', 'testEnvironment'])
@Index(['systemUnderTestId'])
@Index(['testEnvironment'])
@Index(['grafanaInstanceId'])
@Index(['grafanaDashboardId'])
@Index(['dashboardUid'])
@Index(['dashboardLabel'])
export class ApplicationDashboard {
  // Phase 5a audit logging — user-mutable linkage + dashboard scope fields.
  // Identity ids (system_under_test_id, grafana_*) and the dashboard handle
  // (dashboardUid/Label/Name) are auditable so renames or rebindings produce
  // a clear diff. `variables` and `replacedTemplatingVariables` are JSONB
  // payloads but are user-edited (per-SUT/per-environment overrides), not
  // Grafana-derived bulk JSON, so they're auditable. Ownership tracking and
  // timestamps are excluded; the audit envelope records actor + org scope.
  static auditableFields = [
    'systemUnderTestId',
    'testEnvironment',
    'grafanaInstanceId',
    'grafanaDashboardId',
    'dashboardName',
    'dashboardId',
    'dashboardUid',
    'dashboardLabel',
    'tags',
    'templateDashboardUid',
    'variables',
    'replacedTemplatingVariables',
    'snapshotTimeout',
    'metricsSourceId',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255 })
  testEnvironment!: string;

  @Column({ name: 'grafana_instance_id', type: 'uuid', nullable: true })
  grafanaInstanceId?: string;

  @Column({ name: 'grafana_dashboard_id', type: 'uuid', nullable: true })
  grafanaDashboardId?: string;

  @Column({ name: 'dashboard_name', type: 'varchar', length: 255 })
  dashboardName!: string;

  @Column({ name: 'dashboard_id', type: 'bigint', nullable: true })
  dashboardId?: number;

  @Column({ name: 'dashboard_uid', type: 'varchar', length: 100, nullable: true })
  dashboardUid?: string;

  @Column({ name: 'dashboard_label', type: 'varchar', length: 255 })
  dashboardLabel!: string;

  @Column({ name: 'tags', type: 'text', array: true, nullable: true })
  tags?: string[];

  @Column({ name: 'template_dashboard_uid', type: 'varchar', length: 100, nullable: true })
  templateDashboardUid?: string;

  @Column({ name: 'variables', type: 'jsonb', nullable: true })
  variables?: Record<string, unknown>;

  @Column({ name: 'replaced_templating_variables', type: 'jsonb', nullable: true })
  replacedTemplatingVariables?: Record<string, unknown>;

  @Column({ name: 'snapshot_timeout', type: 'integer', default: 4 })
  snapshotTimeout!: number;

  // Ownership tracking (RBAC Phase 2)
  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'created_by' })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'updated_by' })
  updatedBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => SystemUnderTest)
  @JoinColumn({ name: 'system_under_test_id' })
  systemUnderTest?: SystemUnderTest;

  @ManyToOne(() => GrafanaInstance)
  @JoinColumn({ name: 'grafana_instance_id' })
  grafanaInstance?: GrafanaInstance;

  @ManyToOne(() => GrafanaDashboard)
  @JoinColumn({ name: 'grafana_dashboard_id' })
  grafanaDashboard?: GrafanaDashboard;

  // Forward link to MetricsSource (Phase 3.2.2)
  @Column({ type: 'uuid', nullable: true, name: 'metrics_source_id' })
  metricsSourceId?: string;

  @ManyToOne('MetricsSource')
  @JoinColumn({ name: 'metrics_source_id' })
  metricsSource?: unknown;
}