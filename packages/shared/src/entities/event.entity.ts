import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { SystemUnderTest } from './system-under-test.entity';

@Entity('events')
@Index('idx_events_system_env', ['systemUnderTestId', 'testEnvironment'])
@Index('idx_events_timestamp', ['timestamp'])
@Index('idx_events_organization_id', ['organizationId'])
@Index('idx_events_source', ['source'])
export class Event {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255 })
  testEnvironment!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  workload?: string;

  @Column({ type: 'timestamp with time zone' })
  timestamp!: Date;

  @Column({ type: 'varchar', length: 50, default: 'manual' })
  source!: string;

  @Column({ type: 'text', array: true, nullable: true })
  tags?: string[];

  @Column({ name: 'alert_metadata', type: 'jsonb', nullable: true })
  alertMetadata?: Record<string, unknown>;

  @Column({ name: 'grafana_annotation_ids', type: 'jsonb', nullable: true, default: '{}' })
  grafanaAnnotationIds?: Record<string, number>;

  // Ownership tracking (RBAC)
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

  @ManyToOne(() => SystemUnderTest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'system_under_test_id' })
  systemUnderTest?: SystemUnderTest;
}
