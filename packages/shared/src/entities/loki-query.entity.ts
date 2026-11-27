import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { LokiConfig } from './loki-config.entity';

/**
 * One Loki panel for a SUT / environment / workload. `logql` is `$entities` plus pipeline stages
 * only; Perfana puts the mapped selector in place of `$entities` and wraps the aggregation and the
 * bucket range around it, so a panel can never read another stream or at the wrong resolution.
 */
@Entity('loki_queries')
export class LokiQuery {
  static auditableFields = ['lokiConfigId', 'systemUnderTestId', 'testEnvironment', 'workload', 'dashboardLabel', 'panelTitle', 'panelId', 'logql', 'splitBy', 'aggregation', 'metricUnit', 'maxSeries', 'enabled'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'loki_config_id', type: 'uuid' })
  lokiConfigId!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255 })
  testEnvironment!: string;

  @Column({ type: 'varchar', length: 255 })
  workload!: string;

  @Column({ name: 'dashboard_label', type: 'varchar', length: 255, default: 'Loki logs' })
  dashboardLabel!: string;

  @Column({ name: 'application_dashboard_id', type: 'uuid', nullable: true })
  applicationDashboardId?: string | null;

  @Column({ name: 'metrics_source_id', type: 'uuid', nullable: true })
  metricsSourceId?: string | null;

  @Column({ name: 'panel_title', type: 'varchar', length: 500 })
  panelTitle!: string;

  @Column({ name: 'panel_id', type: 'integer' })
  panelId!: number;

  @Column({ type: 'text' })
  logql!: string;

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

  @ManyToOne(() => LokiConfig, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'loki_config_id' })
  lokiConfig?: LokiConfig;
}
