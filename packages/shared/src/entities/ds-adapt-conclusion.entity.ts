import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('ds_adapt_conclusion')
export class DsAdaptConclusion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  test_run_id!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  control_group_id?: string;

  @Column({ type: 'uuid', array: true, nullable: true })
  regressions?: string[];

  @Column({ type: 'uuid', array: true, nullable: true })
  improvements?: string[];

  @Column({ type: 'uuid', array: true, nullable: true })
  differences?: string[];

  @Column({ type: 'uuid', array: true, default: '{}' })
  tracked_regressions!: string[];

  @Column({
    type: 'varchar',
    length: 50
  })
  conclusion!: string;

  @Column({ type: 'jsonb' })
  details!: Record<string, unknown>;

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
}