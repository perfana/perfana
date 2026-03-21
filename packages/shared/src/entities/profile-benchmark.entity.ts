import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Profile } from './profile.entity';

@Entity('profile_benchmarks')
@Index('idx_profile_benchmarks_profile_id', ['profile_id'])
@Index('idx_profile_benchmarks_dashboard_id', ['profile_dashboard_id'])
@Index('idx_profile_benchmarks_workload_pattern', ['workload_pattern'])
export class ProfileBenchmark {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Foreign key to profile
  @Column({ type: 'uuid' })
  profile_id!: string;

  // Reference to profile_grafana_dashboards configuration
  @Column({ type: 'uuid' })
  profile_dashboard_id!: string;

  // Workload matching pattern (from addForWorkloadsMatchingRegex)
  @Column({ type: 'varchar', length: 500, default: '.*' })
  workload_pattern!: string;

  // Source type (grafana, dynatrace)
  @Column({ type: 'varchar', length: 50, default: 'grafana' })
  source!: string;

  // Dashboard and panel references
  @Column({ type: 'varchar', length: 255, nullable: true })
  grafana_instance?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_uid?: string;

  @Column({ type: 'int', nullable: true })
  panel_id?: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  panel_title?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  panel_type?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  panel_description?: string;

  // Metric evaluation configuration
  @Column({ type: 'varchar', length: 50, nullable: true })
  evaluate_type?: string; // avg, max, min, last, fit

  @Column({ type: 'varchar', length: 50, nullable: true })
  metric_unit?: string;

  // Service Level Objective (requirement)
  @Column({ type: 'varchar', length: 50, nullable: true })
  requirement_operator?: string; // gt, lt, gte, lte, eq, ne

  @Column({ type: 'numeric', nullable: true })
  requirement_value?: number;

  // Advanced options
  @Column({ type: 'boolean', default: true })
  exclude_ramp_up_time!: boolean;

  @Column({ type: 'boolean', default: false })
  average_all!: boolean;

  @Column({ type: 'text', nullable: true })
  match_pattern?: string; // Series matching regex

  @Column({ type: 'boolean', default: false })
  validate_with_default_if_no_data!: boolean;

  @Column({ type: 'numeric', nullable: true })
  validate_with_default_if_no_data_value?: number;

  // Metadata
  @Column({ type: 'text', array: true, default: '{}' })
  tags!: string[];

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  read_only?: boolean;

  // Ownership tracking (added in Phase 4 for multi-tenant support)
  @Column({ type: 'uuid', nullable: true, name: 'organization_id' })
  organizationId?: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'created_by' })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'updated_by' })
  updatedBy?: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profile_id' })
  profile!: Profile;
}
