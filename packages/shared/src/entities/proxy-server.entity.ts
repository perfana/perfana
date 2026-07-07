import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';
import { encryptedColumnTransformer } from '../utils/encrypted-column.transformer';

@Entity('proxy_servers')
@Unique('uq_proxy_servers_organization', ['organizationId'])
export class ProxyServer {
  // Phase 5a audit logging — connection metadata + username; the password secret is never auditable.
  static auditableFields = ['proxyUrl', 'username'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;

  @Column({ type: 'text', name: 'proxy_url' })
  proxyUrl!: string;

  @Column({ type: 'text', nullable: true, transformer: encryptedColumnTransformer })
  username?: string;

  @Column({ type: 'text', nullable: true, transformer: encryptedColumnTransformer })
  password?: string;

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
