import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('alert_tag_filters')
@Index('idx_alert_tag_filters_source_type', ['alertSource', 'filterType'])
@Index('idx_alert_tag_filters_organization_id', ['organizationId'])
export class AlertTagFilter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'filter_type', type: 'varchar', length: 20 })
  filterType!: string; // 'omit' | 'abort'

  @Column({ name: 'alert_source', type: 'varchar', length: 50 })
  alertSource!: string; // 'grafana' | 'alertmanager'

  @Column({ name: 'tag_key', type: 'varchar', length: 255 })
  tagKey!: string;

  @Column({ name: 'tag_value', type: 'varchar', length: 255, nullable: true })
  tagValue?: string;

  @Column({ name: 'system_under_test_id', type: 'uuid', nullable: true })
  systemUnderTestId?: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255, nullable: true })
  testEnvironment?: string;

  @Column({ name: 'test_type', type: 'varchar', length: 255, nullable: true })
  workload?: string;

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
}
