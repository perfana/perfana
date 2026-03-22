import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SystemUnderTest } from './system-under-test.entity';

/**
 * MetricsSource — universal adapter for all metrics data sources.
 *
 * Replaces the "artificial Grafana dashboard" pattern where Dynatrace
 * and performance-test metrics were forced into fake GrafanaDashboard rows.
 * Each MetricsSource represents one logical grouping of metrics from
 * a specific source (a Grafana dashboard, a Dynatrace entity, a JMeter
 * scenario, etc).
 *
 * ┌─────────────────────────────────────────────────┐
 * │ source_type    │ source_config_id points to      │
 * │────────────────┼─────────────────────────────────│
 * │ grafana        │ GrafanaInstance.id               │
 * │ dynatrace      │ DynatraceConfig.id              │
 * │ prometheus     │ (future)                        │
 * │ influxdb       │ (future)                        │
 * │ performance_test │ null (data is local)          │
 * └─────────────────────────────────────────────────┘
 *
 * Phase 3 of the rebuild plan. Initially coexists with ApplicationDashboard.
 * Downstream entities will be migrated incrementally.
 */
@Entity('metrics_sources')
@Unique('uq_metrics_sources_unique', [
  'systemUnderTestId',
  'testEnvironment',
  'sourceType',
  'externalRef',
  'displayName',
  'displayLabel',
])
@Index(['systemUnderTestId', 'testEnvironment'])
@Index(['systemUnderTestId'])
@Index(['sourceType'])
@Index(['sourceConfigId'])
export class MetricsSource {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255 })
  testEnvironment!: string;

  @Column({ name: 'workload', type: 'varchar', length: 255, nullable: true })
  workload?: string;

  @Column({ name: 'source_type', type: 'varchar', length: 50 })
  sourceType!: string;

  @Column({ name: 'source_config_id', type: 'uuid', nullable: true })
  sourceConfigId?: string;

  @Column({ name: 'external_ref', type: 'varchar', length: 255, nullable: true })
  externalRef?: string;

  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  displayName!: string;

  @Column({ name: 'display_label', type: 'varchar', length: 255, nullable: true })
  displayLabel?: string;

  @Column({ name: 'tags', type: 'text', array: true, nullable: true })
  tags?: string[];

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'uuid', nullable: true, name: 'organization_id' })
  organizationId?: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'created_by' })
  createdBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => SystemUnderTest)
  @JoinColumn({ name: 'system_under_test_id' })
  systemUnderTest?: SystemUnderTest;
}

export type MetricsSourceType =
  | 'grafana'
  | 'dynatrace'
  | 'prometheus'
  | 'influxdb'
  | 'performance_test';
