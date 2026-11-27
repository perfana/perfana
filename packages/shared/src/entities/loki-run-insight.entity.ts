import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * A run's top log patterns, snapshotted at analysis (Loki's pattern ingester keeps hours, not
 * weeks). `source` is 'patterns' (Loki's patterns API, counts over every line) or 'sampled'
 * (lines clustered by shape, counts over the sample only). Written by the worker only.
 */
@Entity('loki_run_patterns')
export class LokiRunPattern {
  static auditableFields = [] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'test_run_id', type: 'varchar', length: 255 })
  testRunId!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'loki_config_id', type: 'uuid', nullable: true })
  lokiConfigId?: string | null;

  @Column({ type: 'text' })
  pattern!: string;

  @Column({ name: 'pattern_key', type: 'text' })
  patternKey!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  level?: string | null;

  @Column({ type: 'bigint' })
  count!: string;

  @Column({ name: 'first_seen', type: 'timestamptz', nullable: true })
  firstSeen?: Date | null;

  @Column({ name: 'last_seen', type: 'timestamptz', nullable: true })
  lastSeen?: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'patterns' })
  source!: 'patterns' | 'sampled';

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

/** The newest error and warning lines of a run, snapshotted at analysis. Written by the worker only. */
@Entity('loki_run_samples')
export class LokiRunSample {
  static auditableFields = [] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'test_run_id', type: 'varchar', length: 255 })
  testRunId!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'loki_config_id', type: 'uuid', nullable: true })
  lokiConfigId?: string | null;

  @Column({ type: 'timestamptz' })
  time!: Date;

  @Column({ type: 'varchar', length: 50, nullable: true })
  level?: string | null;

  @Column({ type: 'text' })
  line!: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  labels!: Record<string, string>;

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
