import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('ds_control_groups')
export class DsControlGroups {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  control_group_id!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  system_under_test_id?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  workload?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  test_environment?: string;

  @Column({ type: 'integer', default: 0 })
  n_test_runs!: number;

  @Column({ type: 'text', array: true, nullable: true })
  test_runs?: string[];

  @Column({ type: 'timestamptz', nullable: true })
  first_datetime?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_datetime?: Date;

  @Column({ type: 'jsonb', default: {} })
  metric_filters!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  change_point?: Record<string, unknown>;

  @Column({ type: 'uuid', nullable: true })
  organization_id?: string;

  @Column({ type: 'uuid', nullable: true })
  team_id?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by?: string;

  @UpdateDateColumn()
  updated_at!: Date;

  @CreateDateColumn()
  created_at!: Date;
}