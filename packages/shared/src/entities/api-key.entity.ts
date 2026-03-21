import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('api_keys')
@Index('idx_api_keys_api_key', ['apiKey'])
@Index('idx_api_keys_valid_until', ['validUntil'])
@Index('idx_api_keys_roles', ['roles'])
@Index('idx_api_keys_organization_id', ['organization_id'])
@Index('idx_api_keys_created_by', ['created_by'])
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'api_key', type: 'varchar', unique: true })
  apiKey!: string;

  @Column({ type: 'varchar' })
  description!: string;

  @Column({ type: 'text', array: true, default: '{}' })
  roles!: string[];

  @Column({ name: 'valid_until', type: 'timestamp with time zone', nullable: true })
  validUntil?: Date;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organization_id?: string;

  @Column({ name: 'created_by', type: 'varchar', length: 255, nullable: true })
  created_by?: string;

  @Column({ name: 'updated_by', type: 'varchar', length: 255, nullable: true })
  updated_by?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone', default: () => 'now()' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone', default: () => 'now()' })
  updatedAt!: Date;

  @Column({ name: 'last_used', type: 'timestamp with time zone', nullable: true })
  lastUsed?: Date;
}