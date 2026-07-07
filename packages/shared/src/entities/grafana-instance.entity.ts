import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { ApplicationDashboard } from './application-dashboard.entity';
import { encryptedColumnTransformer } from '../utils/encrypted-column.transformer';
import { stripTrailingSlashTransformer } from '../utils/url-column.transformer';

@Entity('grafana_instances')
export class GrafanaInstance {
  // Phase 5a audit logging — connection metadata only.
  // `apiKey` and `password` are encrypted credentials and NEVER auditable.
  // Ownership tracking and timestamps are excluded; the audit envelope already
  // records actor + org scope.
  static auditableFields = [
    'label',
    'client_url',
    'server_url',
    'orgId',
    'username',
    'snapshotInstance',
    'useProxy',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ type: 'text', transformer: stripTrailingSlashTransformer })
  client_url!: string;

  @Column({ type: 'text', nullable: true, transformer: stripTrailingSlashTransformer })
  server_url?: string;

  @Column({ type: 'varchar', length: 255, name: 'org_id' })
  orgId!: string;

  @Column({ type: 'text', nullable: true, name: 'api_key', transformer: encryptedColumnTransformer })
  apiKey?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  username?: string;

  @Column({ type: 'text', nullable: true, transformer: encryptedColumnTransformer })
  password?: string;

  @Column({ type: 'boolean', nullable: true, name: 'snapshot_instance' })
  snapshotInstance?: boolean;

  @Column({ type: 'boolean', name: 'use_proxy', default: false })
  useProxy!: boolean;

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

  @OneToMany(() => ApplicationDashboard, dashboard => dashboard.grafanaInstance)
  applicationDashboards?: ApplicationDashboard[];
}
