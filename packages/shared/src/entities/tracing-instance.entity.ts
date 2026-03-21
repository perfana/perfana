import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { TracingUI } from './tracing-ui.enum';
import { stripTrailingSlashTransformer } from '../utils/url-column.transformer';

@Entity('tracing_instances')
export class TracingInstance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  label!: string;

  @Column({ type: 'text', name: 'tracing_url', transformer: stripTrailingSlashTransformer })
  tracingUrl!: string;

  @Column({ type: 'text', name: 'tracing_api_url', nullable: true, transformer: stripTrailingSlashTransformer })
  tracingApiUrl?: string;

  @Column({
    type: 'enum',
    enum: TracingUI,
    name: 'tracing_ui',
  })
  tracingUi!: TracingUI;

  @Column({ type: 'boolean', default: false, name: 'tracing_iframe_allowed' })
  tracingIframeAllowed!: boolean;

  // Ownership tracking (RBAC Phase 2)
  @Column({ type: 'uuid', nullable: true, name: 'organization_id' })
  organizationId?: string;

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
