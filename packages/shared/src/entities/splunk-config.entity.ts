import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { encryptedColumnTransformer } from '../utils/encrypted-column.transformer';
import { stripTrailingSlashTransformer } from '../utils/url-column.transformer';

/** One Splunk Platform deployment. Spec: docs/reference/Features/Splunk Log Metrics (spec).md. */
@Entity('splunk_configs')
export class SplunkConfig {
  // Credentials are never auditable.
  static auditableFields = ['label', 'host', 'clientUrl', 'username', 'splunkApp', 'verifyTls', 'useProxy', 'maxConcurrentSearches'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  /** Management URL (port 8089). Every server-side call goes here. */
  @Column({ type: 'varchar', length: 500, transformer: stripTrailingSlashTransformer })
  host!: string;

  /** Splunk Web URL for deep links; falls back to `host` when unset (Dynatrace polarity). */
  @Column({ name: 'client_url', type: 'varchar', length: 500, nullable: true, transformer: stripTrailingSlashTransformer })
  clientUrl?: string | null;

  /** Splunk authentication token. Wins over username/password when set. */
  @Column({ name: 'api_token', type: 'text', nullable: true, transformer: encryptedColumnTransformer })
  apiToken?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  username?: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedColumnTransformer })
  password?: string | null;

  @Column({ name: 'splunk_app', type: 'varchar', length: 100, default: 'search' })
  splunkApp!: string;

  // ponytail: stored and shown, not yet enforced — Node's fetch has no per-request TLS opt-out
  // without an undici Agent; wire it with the proxy dispatcher when an on-prem self-signed case appears.
  @Column({ name: 'verify_tls', type: 'boolean', default: true })
  verifyTls!: boolean;

  @Column({ name: 'use_proxy', type: 'boolean', default: false })
  useProxy!: boolean;

  @Column({ name: 'max_concurrent_searches', type: 'integer', default: 2 })
  maxConcurrentSearches!: number;

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
