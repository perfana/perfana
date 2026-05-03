import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { GrafanaInstance } from './grafana-instance.entity';

@Entity('grafana_dashboards')
@Index(['grafanaInstanceId'])
@Index(['uid'])
@Index(['name'])
export class GrafanaDashboard {
  // Phase 5a audit logging — dashboard identity + lightweight metadata only.
  // `panels`, `variables`, `grafanaJson`, `applicationDashboardVariables`,
  // `templateTestRunVariables`, `templateCreateDate` are bulk Grafana-derived
  // JSON re-synced by the grafana-sync service and excluded as system-derived
  // (would generate large, noisy diffs on every sync). The `updated` column
  // is a Grafana-side timestamp also bumped on sync. Ownership tracking and
  // timestamps are excluded; the audit envelope records actor + org scope.
  static auditableFields = [
    'grafanaInstanceId',
    'grafanaId',
    'datasourceType',
    'uid',
    'slug',
    'name',
    'uri',
    'templatingVariables',
    'tags',
    'usedBySut',
    'templateDashboardUid',
    'templateProfile',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'grafana_instance_id', type: 'uuid' })
  grafanaInstanceId!: string;

  @Column({ name: 'grafana_id', type: 'bigint' })
  grafanaId!: number;

  @Column({ name: 'datasource_type', type: 'varchar', nullable: true })
  datasourceType?: string;

  @Column({ type: 'varchar', length: 255 })
  uid!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  slug?: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  uri?: string;

  @Column({ name: 'templating_variables', type: 'jsonb', nullable: true })
  templatingVariables?: unknown[];

  @Column({ type: 'jsonb' })
  panels!: unknown[];

  @Column({ type: 'jsonb', nullable: true })
  variables?: unknown[];

  @Column({ type: 'text', array: true, nullable: true })
  tags?: string[];

  @Column({ name: 'used_by_sut', type: 'text', array: true, nullable: true })
  usedBySut?: string[];

  @Column({ name: 'template_dashboard_uid', type: 'varchar', length: 255, nullable: true })
  templateDashboardUid?: string;

  @Column({ name: 'template_profile', type: 'varchar', length: 255, nullable: true })
  templateProfile?: string;

  @Column({ name: 'template_test_run_variables', type: 'jsonb', nullable: true })
  templateTestRunVariables?: unknown;

  @Column({ name: 'template_create_date', type: 'timestamp with time zone', nullable: true })
  templateCreateDate?: Date;

  @Column({ name: 'application_dashboard_variables', type: 'jsonb', nullable: true })
  applicationDashboardVariables?: unknown;

  @Column({ name: 'grafana_json', type: 'jsonb', nullable: true })
  grafanaJson?: unknown;

  @Column({ type: 'timestamp with time zone', nullable: true })
  updated?: Date;

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

  @ManyToOne(() => GrafanaInstance)
  @JoinColumn({ name: 'grafana_instance_id' })
  grafanaInstance?: GrafanaInstance;
}
