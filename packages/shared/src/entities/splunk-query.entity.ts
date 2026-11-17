import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { SplunkConfig } from './splunk-config.entity';

/**
 * One Splunk panel for a SUT / environment / workload. `spl` is a filter only — usually
 * `$entities` plus a condition. Perfana appends the run window and `| timechart`, so a query can
 * never read outside the run or at the wrong resolution.
 */
@Entity('splunk_queries')
export class SplunkQuery {
  static auditableFields = ['splunkConfigId', 'systemUnderTestId', 'testEnvironment', 'workload', 'dashboardLabel', 'panelTitle', 'panelId', 'spl', 'splitBy', 'aggregation', 'metricUnit', 'maxSeries', 'enabled'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'splunk_config_id', type: 'uuid' })
  splunkConfigId!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255 })
  testEnvironment!: string;

  @Column({ type: 'varchar', length: 255 })
  workload!: string;

  @Column({ name: 'dashboard_label', type: 'varchar', length: 255, default: 'Splunk logs' })
  dashboardLabel!: string;

  /** Artificial dashboard, filled on first collection. */
  @Column({ name: 'application_dashboard_id', type: 'uuid', nullable: true })
  applicationDashboardId?: string | null;

  @Column({ name: 'metrics_source_id', type: 'uuid', nullable: true })
  metricsSourceId?: string | null;

  @Column({ name: 'panel_title', type: 'varchar', length: 500 })
  panelTitle!: string;

  @Column({ name: 'panel_id', type: 'integer' })
  panelId!: number;

  @Column({ type: 'text' })
  spl!: string;

  @Column({ name: 'split_by', type: 'varchar', length: 255, nullable: true })
  splitBy?: string | null;

  @Column({ type: 'varchar', length: 100, default: 'count' })
  aggregation!: string;

  @Column({ name: 'metric_unit', type: 'varchar', length: 50, default: 'short' })
  metricUnit!: string;

  @Column({ name: 'max_series', type: 'integer', default: 20 })
  maxSeries!: number;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

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

  @ManyToOne(() => SplunkConfig, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'splunk_config_id' })
  splunkConfig?: SplunkConfig;
}
