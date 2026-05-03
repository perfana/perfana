import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { DynatraceConfig } from './dynatrace-config.entity';

@Entity('dynatrace_entity_mappings')
export class DynatraceEntityMapping {
  // Phase 5a audit logging — entity-mapping definition fields.
  // Ownership tracking and timestamps are excluded; the audit envelope
  // already carries actor + org scope.
  static auditableFields = [
    'dynatraceConfigId',
    'systemUnderTestId',
    'testEnvironment',
    'workload',
    'entityId',
    'entityDisplayName',
    'entityType',
    'level',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'dynatrace_config_id', type: 'uuid' })
  dynatraceConfigId!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255, nullable: true })
  testEnvironment?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  workload?: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 255 })
  entityId!: string;

  @Column({ name: 'entity_display_name', type: 'varchar', length: 500 })
  entityDisplayName!: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 100 })
  entityType!: string;

  @Column({ type: 'varchar', length: 50 })
  level!: string;

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

  @ManyToOne(() => DynatraceConfig)
  @JoinColumn({ name: 'dynatrace_config_id' })
  dynatraceConfig?: DynatraceConfig;
}
