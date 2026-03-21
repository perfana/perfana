import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { DynatraceConfig } from './dynatrace-config.entity';

@Entity('dynatrace_queries')
export class DynatraceQuery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'dynatrace_config_id', type: 'uuid' })
  dynatraceConfigId!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255 })
  testEnvironment!: string;

  @Column({ type: 'varchar', length: 255 })
  workload!: string;

  @Column({ name: 'dashboard_label', type: 'varchar', length: 500 })
  dashboardLabel!: string;

  @Column({ name: 'application_dashboard_id', type: 'uuid', nullable: true })
  applicationDashboardId?: string;

  @Column({ name: 'panel_title', type: 'varchar', length: 500 })
  panelTitle!: string;

  @Column({ name: 'panel_id', type: 'integer' })
  panelId!: number;

  @Column({ name: 'query', type: 'text' })
  query!: string;

  @Column({ name: 'match_metric_pattern', type: 'varchar', length: 500, nullable: true })
  matchMetricPattern?: string;

  @Column({ name: 'omit_group_by_variable_from_metric_name', type: 'text', array: true, default: '{}' })
  omitGroupByVariableFromMetricName!: string[];

  @Column({ name: 'template_variables', type: 'jsonb', default: '{}' })
  templateVariables!: Record<string, string>;

  @Column({ name: 'metric_unit', type: 'varchar', length: 50, nullable: true })
  metricUnit?: string;

  @Column({ name: 'metric_name', type: 'varchar', length: 255, nullable: true })
  metricName?: string;

  // Ownership tracking (RBAC Phase 2)
  @Column({ type: 'uuid', nullable: true, name: 'organization_id' })
  organizationId?: string;

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

  @ManyToOne(() => DynatraceConfig)
  @JoinColumn({ name: 'dynatrace_config_id' })
  dynatraceConfig?: DynatraceConfig;
}
