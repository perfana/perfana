import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';
import type { SeriesGroupingAggregation } from '../utils/series-grouping';

/**
 * The raw -> group membership a run's statistics were computed with: one row per raw series of a
 * grouped panel. Written by StatisticsPipeline inside the same transaction as
 * ds_metric_statistics (delete-then-insert per run), so the two can never disagree. Read by the
 * API to expand a group name back into its member series, because `ds_metrics` only holds raw
 * names. Created by migration 1819. Derived, like ds_metric_statistics: no RLS policy.
 */
@Entity('ds_metric_series_groups')
@Index('idx_ds_metric_series_groups_group', ['test_run_id', 'application_dashboard_id', 'panel_id', 'group_name'])
@Index('idx_ds_metric_series_groups_label', ['test_run_id', 'dashboard_label', 'panel_title', 'panel_id'])
@Index('idx_ds_metric_series_groups_app_dashboard', ['application_dashboard_id'])
@Index('idx_ds_metric_series_groups_rule', ['rule_id'])
export class DsMetricSeriesGroup {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  test_run_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  application_dashboard_id!: string;

  @PrimaryColumn({ type: 'integer' })
  panel_id!: number;

  /** The raw series name, as stored in ds_metrics. */
  @PrimaryColumn({ type: 'varchar', length: 255 })
  metric_name!: string;

  @Column({ type: 'varchar', length: 255 })
  group_name!: string;

  /**
   * The group's member-count series name (e.g. `api (pod count)`), when the rule tracks it.
   * That series exists only in ds_metric_statistics, never in ds_metrics, so a chart reader
   * draws it as COUNT(*) of the members per timestamp. NULL when not tracked.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  member_count_name!: string | null;

  /** Copied from ds_metrics: some readers address a panel by label and title, not by id. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_label!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  panel_title!: string | null;

  /** Copied from the rule, so a chart can redraw the group without the rule. */
  @Column({ type: 'varchar', length: 8 })
  aggregation!: SeriesGroupingAggregation;

  /** Average members reporting per timestamp; ~1 on a multi-member group means unaligned timestamps. */
  @Column({ type: 'real', nullable: true })
  avg_members!: number | null;

  /** NULL once the rule is deleted (ON DELETE SET NULL): the run is then stale. */
  @Column({ type: 'uuid', nullable: true })
  rule_id!: string | null;

  @Column({ type: 'varchar', length: 16 })
  rule_hash!: string;

  @Column({ type: 'uuid', nullable: true })
  organization_id!: string | null;

  @Column({ type: 'uuid', nullable: true })
  team_id!: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at!: Date;
}
