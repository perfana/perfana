import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { encryptedColumnTransformer } from '../utils/encrypted-column.transformer';
import { stripTrailingSlashTransformer } from '../utils/url-column.transformer';

export type ConfluenceDeployment = 'cloud' | 'datacenter';

/**
 * One Confluence space that reports can be published to. Cloud authenticates with an Atlassian
 * account email + API token (Basic); Data Center / Server with a personal access token (Bearer).
 */
@Entity('confluence_configs')
export class ConfluenceConfig {
  static auditableFields = ['label', 'baseUrl', 'deployment', 'username', 'spaceKey', 'parentPageId', 'useProxy'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  /** Cloud: https://<site>.atlassian.net (no /wiki). Data Center: the base URL incl. any context path. */
  @Column({ name: 'base_url', type: 'varchar', length: 500, transformer: stripTrailingSlashTransformer })
  baseUrl!: string;

  @Column({ type: 'varchar', length: 20, default: 'cloud' })
  deployment!: ConfluenceDeployment;

  /** Atlassian account email (Cloud only). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  username?: string | null;

  /** Cloud API token, or Data Center personal access token. */
  @Column({ name: 'api_token', type: 'text', transformer: encryptedColumnTransformer })
  apiToken!: string;

  @Column({ name: 'space_key', type: 'varchar', length: 255 })
  spaceKey!: string;

  /** Pages are created under this page; NULL = at the space root. */
  @Column({ name: 'parent_page_id', type: 'varchar', length: 64, nullable: true })
  parentPageId?: string | null;

  @Column({ name: 'use_proxy', type: 'boolean', default: false })
  useProxy!: boolean;

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
