import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique, ManyToOne, JoinColumn } from 'typeorm';
import { SystemUnderTest } from './system-under-test.entity';

export type NotificationChannelType = 'slack' | 'teams';

@Entity('notification_channels')
@Unique('uq_notification_channels_system_name', ['systemUnderTestId', 'name'])
@Index(['systemUnderTestId'])
@Index(['enabled'])
export class NotificationChannel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ type: 'varchar', length: 20 })
  type!: NotificationChannelType;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'webhook_url', type: 'text' })
  webhookUrl!: string;

  @Column({ name: 'notify_on_finished', type: 'boolean', default: true })
  notifyOnFinished!: boolean;

  @Column({ name: 'notify_on_failed_only', type: 'boolean', default: false })
  notifyOnFailedOnly!: boolean;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

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

  @ManyToOne(() => SystemUnderTest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'system_under_test_id' })
  systemUnderTest?: SystemUnderTest;
}
