import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { encryptedColumnTransformer } from '../utils/encrypted-column.transformer';
import { stripTrailingSlashTransformer } from '../utils/url-column.transformer';

@Entity('dynatrace_configs')
export class DynatraceConfig {
  // Phase 5a audit logging — mutable connection metadata only.
  // `apiToken` and `platformApiToken` are encrypted credentials and NEVER auditable.
  // Ownership tracking (organizationId/teamId/createdBy/updatedBy) and timestamps
  // are excluded; the audit envelope already records actor + org scope.
  static auditableFields = [
    'host',
    'clientUrl',
    'label',
    'dynatraceType',
    'perfanaTestRunIdAttribute',
    'perfanaRequestNameAttribute',
    'useProxy',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Server-side URL: every outbound API call from api/worker goes here. */
  @Column({ type: 'varchar', length: 500, transformer: stripTrailingSlashTransformer })
  host!: string;

  /**
   * Browser-facing URL for deep links, when it differs from `host` (proxy, split DNS).
   * Falls back to `host` when unset — see `deepLinkBaseUrl` in the web app.
   *
   * Note the polarity is deliberately the opposite of GrafanaInstance, where
   * `client_url` is required and `server_url` is the optional override: here the
   * server URL (`host`) is the required one, since it is what the API actually calls.
   */
  @Column({ name: 'client_url', type: 'varchar', length: 500, nullable: true, transformer: stripTrailingSlashTransformer })
  clientUrl?: string;

  @Column({
    name: 'api_token',
    type: 'text',
    transformer: encryptedColumnTransformer,
  })
  apiToken!: string;

  @Column({ name: 'dynatrace_type', type: 'varchar', length: 20, default: 'saas' })
  dynatraceType!: 'saas' | 'managed';

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({
    name: 'platform_api_token',
    type: 'text',
    nullable: true,
    transformer: encryptedColumnTransformer,
  })
  platformApiToken?: string;

  @Column({ name: 'perfana_test_run_id_attribute', type: 'varchar', length: 255, nullable: true })
  perfanaTestRunIdAttribute?: string;

  @Column({ name: 'perfana_request_name_attribute', type: 'varchar', length: 255, nullable: true })
  perfanaRequestNameAttribute?: string;

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
}
