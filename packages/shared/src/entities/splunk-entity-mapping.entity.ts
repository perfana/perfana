import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { SplunkConfig } from './splunk-config.entity';

/**
 * A Splunk log source mapped to a system under test at a level, like dynatrace_entity_mappings.
 * A run uses every mapping matching its scope: level 'sut' (env and workload NULL), 'environment'
 * (workload NULL), 'workload'. Queries reach them through `$entities`.
 */
@Entity('splunk_entity_mappings')
export class SplunkEntityMapping {
  static auditableFields = ['splunkConfigId', 'systemUnderTestId', 'testEnvironment', 'workload', 'level', 'indexName', 'sourcetype', 'hostPattern', 'labels'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'splunk_config_id', type: 'uuid' })
  splunkConfigId!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255, nullable: true })
  testEnvironment?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  workload?: string | null;

  @Column({ type: 'varchar', length: 50 })
  level!: 'sut' | 'environment' | 'workload';

  @Column({ name: 'index_name', type: 'varchar', length: 255 })
  indexName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sourcetype?: string | null;

  /** Exact host or Splunk wildcard (app-*). NULL = any host in the index/sourcetype. */
  @Column({ name: 'host_pattern', type: 'varchar', length: 500, nullable: true })
  hostPattern?: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  labels!: string[];

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
