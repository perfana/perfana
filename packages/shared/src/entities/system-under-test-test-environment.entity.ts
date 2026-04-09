import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { SystemUnderTest } from './system-under-test.entity';
import { SystemUnderTestWorkload } from './system-under-test-workload.entity';

@Entity('system_under_test_test_environments')
export class SystemUnderTestTestEnvironment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  system_under_test_id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  tracing_service?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  pyroscope_application?: string;

  @CreateDateColumn()
  created_at!: Date;

  @ManyToOne(() => SystemUnderTest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'system_under_test_id' })
  systemUnderTest?: SystemUnderTest;

  @OneToMany(() => SystemUnderTestWorkload, workload => workload.testEnvironment, { cascade: true })
  workloads?: SystemUnderTestWorkload[];
}
