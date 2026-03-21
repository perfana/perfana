import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique, ManyToOne, JoinColumn } from 'typeorm';
import { SystemUnderTest } from './system-under-test.entity';
import { ApplicationDashboard } from './application-dashboard.entity';

/**
 * Benchmark types:
 * - 'metric': Traditional Grafana-based SLO with panel queries
 * - 'apdex': Transaction-level Apdex score based on response times from requests_raw
 */
export type BenchmarkType = 'metric' | 'apdex';

@Entity('benchmarks')
// Note: The actual unique constraint uses COALESCE for nullable fields (see migration)
// This decorator documents the uniqueness requirement, but the database handles NULL values specially
@Unique('uq_benchmarks_unique', [
  'system_under_test_id',
  'test_environment',
  'workload',
  'application_dashboard_id',
  'generic_check_id'
])
export class Benchmark {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  system_under_test_id!: string;

  @Column({ type: 'varchar', length: 255 })
  test_environment!: string;

  @Column({ type: 'varchar', length: 255 })
  workload!: string;

  @Column({
    type: 'varchar',
    length: 50,
    default: 'grafana'
  })
  source!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  grafana_instance?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  dashboard_label?: string;

  @Column({ type: 'int', nullable: true })
  dashboard_id?: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_uid?: string;

  @Column({ type: 'uuid', nullable: true })
  application_dashboard_id?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  generic_check_id?: string;

  @Column({ type: 'jsonb', default: '{}' })
  configuration!: Record<string, any>;

  @Column({ type: 'varchar', nullable: true })
  config_title?: string;

  @Column({ type: 'varchar', nullable: true })
  config_id?: string;

  @Column({ type: 'varchar', nullable: true })
  config_type?: string;

  @Column({ type: 'varchar', nullable: true })
  evaluate_type?: string;

  @Column({ type: 'varchar', nullable: true })
  requirement_operator?: string;

  @Column({ type: 'numeric', nullable: true })
  requirement_value?: number;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'boolean', default: true })
  valid!: boolean;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', array: true, default: '{}' })
  tags!: string[];

  @Column({ type: 'boolean', default: false })
  average_all!: boolean;

  @Column({ type: 'text', nullable: true })
  match_pattern?: string;

  @Column({ type: 'boolean', default: false })
  validate_with_default_if_no_data!: boolean;

  @Column({ type: 'numeric', nullable: true })
  validate_with_default_if_no_data_value?: number;

  @Column({ type: 'boolean', default: true })
  exclude_ramp_up_time!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  panel_title?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  metric_unit?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  baseline_test_run_id?: string;

  @Column({ type: 'boolean', default: false })
  alert_on_breach!: boolean;

  @Column({ type: 'text', array: true, default: '{}' })
  alert_channels!: string[];

  // ========================================
  // Apdex SLO Fields
  // ========================================

  /**
   * Type of benchmark: 'metric' for traditional Grafana-based SLOs,
   * 'apdex' for transaction-level Apdex score based on response times
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: 'metric'
  })
  benchmark_type!: BenchmarkType;

  /**
   * Transaction name for Apdex SLOs.
   * - If set: Calculate Apdex for this specific transaction
   * - If null: Calculate workload-level Apdex across all transactions
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  transaction_name?: string;

  /**
   * Apdex T threshold in milliseconds.
   * - Satisfied: response_time <= apdex_threshold_ms
   * - Tolerating: apdex_threshold_ms < response_time <= 4 * apdex_threshold_ms
   * - Frustrated: response_time > 4 * apdex_threshold_ms
   */
  @Column({ type: 'int', nullable: true })
  apdex_threshold_ms?: number;

  /**
   * Minimum required Apdex score (0.0 - 1.0).
   * The benchmark passes if calculated_apdex >= min_apdex_score.
   */
  @Column({ type: 'decimal', precision: 4, scale: 3, nullable: true })
  min_apdex_score?: number;

  /**
   * Whether to include failed requests (success=false) in Apdex calculation.
   * - false (default): Only successful requests are counted
   * - true: All requests are counted (failed requests count as frustrated)
   */
  @Column({ type: 'boolean', default: false })
  include_failed_requests!: boolean;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, any>;

  // Ownership tracking (RBAC Phase 2)
  @Column({ type: 'uuid', nullable: true, name: 'organization_id' })
  organizationId?: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'created_by' })
  created_by?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'updated_by' })
  updated_by?: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @ManyToOne(() => SystemUnderTest)
  @JoinColumn({ name: 'system_under_test_id' })
  system_under_test!: SystemUnderTest;

  @ManyToOne(() => ApplicationDashboard, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_dashboard_id' })
  application_dashboard?: ApplicationDashboard;
}