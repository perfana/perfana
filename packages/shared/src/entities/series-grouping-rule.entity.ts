import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import type { SeriesGroupingAggregation, SeriesGroupingPreset } from '../utils/series-grouping';
import { ApplicationDashboard } from './application-dashboard.entity';
import { SystemUnderTest } from './system-under-test.entity';

export type SeriesGroupingRuleOrigin = 'manual' | 'suggestion' | 'copy';

/**
 * A per-workload rule that rewrites raw series names on one panel (or, with `panelId` null, every
 * panel of an application dashboard) to group names, so StatisticsPipeline compares the group
 * across runs instead of each pod. Created by migration 1819.
 *
 * Application dashboards are per system and environment and shared by that environment's
 * workloads, so the workload lives on the rule, not on the dashboard. The slot
 * (system, environment, workload, dashboard, panel) is unique with NULLS NOT DISTINCT.
 */
@Entity('series_grouping_rules')
@Index('idx_series_grouping_rules_app_dashboard', ['applicationDashboardId'])
export class SeriesGroupingRule {
  // Fields surfaced in audit-log diffs. A rule changes ADAPT verdicts, so every rule field is
  // audited; ownership columns and timestamps are emitted via dedicated audit-row columns.
  static auditableFields = [
    'systemUnderTestId',
    'testEnvironment',
    'workload',
    'applicationDashboardId',
    'panelId',
    'preset',
    'pattern',
    'replacement',
    'aggregation',
    'trackMemberCount',
    'enabled',
    'origin',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255 })
  testEnvironment!: string;

  @Column({ name: 'workload', type: 'varchar', length: 255 })
  workload!: string;

  @Column({ name: 'application_dashboard_id', type: 'uuid' })
  applicationDashboardId!: string;

  /** NULL = every panel on the dashboard. A panel rule overrides a dashboard rule. */
  @Column({ name: 'panel_id', type: 'integer', nullable: true })
  panelId!: number | null;

  @Column({ name: 'preset', type: 'varchar', length: 32 })
  preset!: SeriesGroupingPreset;

  /** Set exactly when `preset` is `custom` (ck_series_grouping_rules_custom_pattern). */
  @Column({ name: 'pattern', type: 'text', nullable: true })
  pattern!: string | null;

  @Column({ name: 'replacement', type: 'text', default: '' })
  replacement!: string;

  @Column({ name: 'aggregation', type: 'varchar', length: 8, default: 'avg' })
  aggregation!: SeriesGroupingAggregation;

  @Column({ name: 'track_member_count', type: 'boolean', default: false })
  trackMemberCount!: boolean;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'origin', type: 'varchar', length: 16, default: 'manual' })
  origin!: SeriesGroupingRuleOrigin;

  // Ownership tracking (RBAC): inherited from the application dashboard on create.
  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'created_by' })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'updated_by' })
  updatedBy?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  @ManyToOne(() => ApplicationDashboard, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_dashboard_id' })
  applicationDashboard?: ApplicationDashboard;

  @ManyToOne(() => SystemUnderTest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'system_under_test_id' })
  systemUnderTest?: SystemUnderTest;
}
