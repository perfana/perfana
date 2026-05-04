import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

export interface DashboardVariable {
  name: string;
  values: string[];
}

@Entity('profile_grafana_dashboards')
@Unique('unique_profile_dashboard_grafana', ['profile', 'dashboardUid', 'grafanaLabel'])
export class ProfileGrafanaDashboard {
  // Phase 5a — fields surfaced in audit-log diffs. Ownership / org / team
  // columns and timestamps are intentionally excluded; they are emitted via
  // dedicated columns on the audit row.
  static auditableFields = [
    'profile',
    'dashboardName',
    'dashboardUid',
    'grafanaLabel',
    'createSeparateDashboardForVariable',
    'setHardcodedValueForVariables',
    'matchRegexForVariables',
    'readOnly',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  @Index('idx_profile_grafana_dashboards_profile')
  profile!: string;

  @Column({ type: 'varchar', length: 255, name: 'dashboard_name' })
  dashboardName!: string;

  @Column({ type: 'varchar', length: 100, name: 'dashboard_uid' })
  @Index('idx_profile_grafana_dashboards_dashboard_uid')
  dashboardUid!: string;

  @Column({ type: 'varchar', length: 255, name: 'grafana_label', default: 'Default' })
  @Index('idx_profile_grafana_dashboards_grafana_label')
  grafanaLabel!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'create_separate_dashboard_for_variable' })
  createSeparateDashboardForVariable?: string;

  @Column({ type: 'jsonb', nullable: true, name: 'set_hardcoded_value_for_variables' })
  setHardcodedValueForVariables?: DashboardVariable[] | null;

  @Column({ type: 'jsonb', nullable: true, name: 'match_regex_for_variables' })
  matchRegexForVariables?: Record<string, string> | null;

  @Column({ type: 'boolean', nullable: true, default: false, name: 'read_only' })
  readOnly?: boolean;

  // Ownership tracking (added in Phase 4 for multi-tenant support)
  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'created_by' })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'updated_by' })
  updatedBy?: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
