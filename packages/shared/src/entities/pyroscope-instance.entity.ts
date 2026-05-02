import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { stripTrailingSlashTransformer } from '../utils/url-column.transformer';

@Entity('pyroscope_instances')
export class PyroscopeInstance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ type: 'text', name: 'pyroscope_url', transformer: stripTrailingSlashTransformer })
  pyroscopeUrl!: string;

  @Column({ type: 'text', name: 'backend_url', nullable: true, transformer: stripTrailingSlashTransformer })
  backendUrl?: string;

  @Column({ type: 'boolean', default: false, name: 'pyroscope_stand_alone' })
  pyroscopeStandAlone!: boolean;

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
