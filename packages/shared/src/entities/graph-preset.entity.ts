import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export interface SeriesConfig {
  dashboardId: string;
  dashboardLabel: string;
  panelId: number;
  panelTitle: string;
  metricName: string;
  source: 'grafana' | 'dynatrace';
  yAxisFormat?: string;
}

export interface ChartOptions {
  // Future customization options
  [key: string]: any;
}

@Entity('graph_presets')
@Index(['name'])
@Index(['isGlobal'])
@Index(['userId'])
@Index(['testRunId'], { where: 'test_run_id IS NOT NULL' })
@Index(['userId', 'testRunId'])
export class GraphPreset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'test_run_id', type: 'varchar', length: 255, nullable: true })
  testRunId?: string;

  @Column({ name: 'user_id', type: 'varchar', length: 255 })
  userId!: string;

  @Column({ name: 'series_config', type: 'jsonb' })
  seriesConfig!: SeriesConfig[];

  @Column({ name: 'chart_options', type: 'jsonb', nullable: true })
  chartOptions?: ChartOptions;

  @Column({ name: 'is_global', type: 'boolean', default: false })
  isGlobal!: boolean;

  // Ownership tracking (RBAC Phase 2)
  @Column({ type: 'uuid', nullable: true, name: 'organization_id' })
  organizationId?: string;

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
}
