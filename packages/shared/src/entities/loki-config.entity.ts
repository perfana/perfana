import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { GrafanaInstance } from './grafana-instance.entity';

/**
 * A Loki datasource on a Grafana instance. Holds no credentials: every query goes through the
 * instance's own (`api_key` or basic auth), to `/api/ds/query` and the datasource's resource calls.
 * Spec: docs/reference/Features/Loki Log Metrics (spec).md.
 */
@Entity('loki_configs')
export class LokiConfig {
  static auditableFields = ['label', 'grafanaInstanceId', 'datasourceUid', 'datasourceName', 'levelLabel', 'levelParser', 'serviceLabel', 'maxConcurrentQueries'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ name: 'grafana_instance_id', type: 'uuid' })
  grafanaInstanceId!: string;

  @Column({ name: 'datasource_uid', type: 'varchar', length: 255 })
  datasourceUid!: string;

  @Column({ name: 'datasource_name', type: 'varchar', length: 255, nullable: true })
  datasourceName?: string | null;

  /** The label (stream label, structured metadata or parsed) carrying a line's level. */
  @Column({ name: 'level_label', type: 'varchar', length: 100, default: 'detected_level' })
  levelLabel!: string;

  /** How the level label is obtained: none (on the line already), json or logfmt (migration 1840). */
  @Column({ name: 'level_parser', type: 'varchar', length: 10, default: 'none' })
  levelParser!: string;

  /** The label that names an application, for the card's per-application view (migration 1839). */
  @Column({ name: 'service_label', type: 'varchar', length: 100, default: 'service_name' })
  serviceLabel!: string;

  @Column({ name: 'max_concurrent_queries', type: 'integer', default: 2 })
  maxConcurrentQueries!: number;

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

  @ManyToOne(() => GrafanaInstance, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grafana_instance_id' })
  grafanaInstance?: GrafanaInstance;
}
