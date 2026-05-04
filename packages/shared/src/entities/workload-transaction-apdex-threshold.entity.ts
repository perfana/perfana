import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';
import type { OwnedResource } from './owned-resource.interface';

@Entity('workload_transaction_apdex_thresholds')
@Unique('unique_workload_transaction_threshold', [
  'system_under_test_id',
  'test_environment',
  'workload',
  'transaction_name',
])
export class WorkloadTransactionApdexThreshold implements OwnedResource {
  static auditableFields = [
    'system_under_test_id',
    'test_environment',
    'workload',
    'transaction_name',
    'apdex_threshold',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  system_under_test_id!: string;

  @Column({ type: 'text' })
  test_environment!: string;

  @Column({ type: 'text' })
  workload!: string;

  @Column({ type: 'text' })
  transaction_name!: string;

  @Column({ type: 'int' })
  apdex_threshold!: number;

  @Column({ type: 'uuid', nullable: true })
  organization_id!: string;

  @Column({ type: 'uuid', nullable: true })
  team_id?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by?: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
