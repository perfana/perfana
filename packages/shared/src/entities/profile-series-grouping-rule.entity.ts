import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import type { SeriesGroupingAggregation, SeriesGroupingPreset } from '../utils/series-grouping';
import { ProfileGrafanaDashboard } from './profile-grafana-dashboard.entity';

/**
 * A series grouping rule on a profile dashboard (migration 1826). grafana-sync's auto-config
 * provisions it into `series_grouping_rules` for every application dashboard built from the profile
 * dashboard, per run workload; those rows carry `profile_rule_id` and follow this row while nobody
 * has edited them (`updated_by IS NULL`). The slot (profile dashboard, panel) is unique with NULLS
 * NOT DISTINCT; `panelId` null means every panel.
 */
@Entity('profile_series_grouping_rules')
export class ProfileSeriesGroupingRule {
  static auditableFields = [
    'profileDashboardId',
    'panelId',
    'preset',
    'pattern',
    'replacement',
    'aggregations',
    'enabled',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'profile_dashboard_id', type: 'uuid' })
  profileDashboardId!: string;

  @Column({ name: 'panel_id', type: 'integer', nullable: true })
  panelId!: number | null;

  @Column({ name: 'preset', type: 'varchar', length: 32 })
  preset!: SeriesGroupingPreset;

  @Column({ name: 'pattern', type: 'text', nullable: true })
  pattern!: string | null;

  @Column({ name: 'replacement', type: 'text', default: '' })
  replacement!: string;

  @Column({ name: 'aggregations', type: 'varchar', length: 8, array: true, default: () => "'{avg}'" })
  aggregations!: SeriesGroupingAggregation[];

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled!: boolean;

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

  @ManyToOne(() => ProfileGrafanaDashboard, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profile_dashboard_id' })
  profileDashboard?: ProfileGrafanaDashboard;
}
