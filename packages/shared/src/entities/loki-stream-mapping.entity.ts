import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import type { LokiMatcher } from '../services/loki/client';
import { LokiConfig } from './loki-config.entity';

/**
 * Loki streams (a set of label matchers) mapped to a system under test at a level, like
 * splunk_entity_mappings. A run uses every mapping matching its scope: level 'sut', 'environment'
 * (workload NULL) and 'workload'. Panels reach them through `$entities`.
 */
@Entity('loki_stream_mappings')
export class LokiStreamMapping {
  static auditableFields = ['lokiConfigId', 'systemUnderTestId', 'testEnvironment', 'workload', 'level', 'selector', 'labels'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'loki_config_id', type: 'uuid' })
  lokiConfigId!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255, nullable: true })
  testEnvironment?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  workload?: string | null;

  @Column({ type: 'varchar', length: 50 })
  level!: 'sut' | 'environment' | 'workload';

  @Column({ type: 'jsonb' })
  matchers!: LokiMatcher[];

  /** `buildStreamSelector(matchers)`, stored for uniqueness and display. */
  @Column({ type: 'varchar', length: 4000 })
  selector!: string;

  /** Perfana tags a query can target with `$entities[tag]`; not Loki labels. */
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

  @ManyToOne(() => LokiConfig, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'loki_config_id' })
  lokiConfig?: LokiConfig;
}
