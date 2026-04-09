import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { SystemUnderTestTestEnvironment } from './system-under-test-test-environment.entity';

@Entity('system_under_test_workloads')
export class SystemUnderTestWorkload {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  system_under_test_test_environment_id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'jsonb', nullable: true })
  config?: Record<string, unknown>;

  @CreateDateColumn()
  created_at!: Date;

  @ManyToOne(() => SystemUnderTestTestEnvironment, env => env.workloads, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'system_under_test_test_environment_id' })
  testEnvironment?: SystemUnderTestTestEnvironment;
}
