import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { SystemUnderTest } from './system-under-test.entity';
import { TracingInstance } from './tracing-instance.entity';
import { TracingUI } from './tracing-ui.enum';

export { TracingUI };

@Entity('tracing_services')
@Index(['systemUnderTestId', 'testEnvironment', 'workload', 'tracingInstanceId'], { unique: true })
export class TracingService {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'system_under_test_id' })
  systemUnderTestId!: string;

  @ManyToOne(() => SystemUnderTest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'system_under_test_id' })
  systemUnderTest!: SystemUnderTest;

  @Column({ type: 'varchar', nullable: true, name: 'test_environment' })
  testEnvironment!: string | null;

  @Column({ type: 'varchar', nullable: true })
  workload!: string | null;

  @Column({ type: 'uuid', name: 'tracing_instance_id' })
  tracingInstanceId!: string;

  @ManyToOne(() => TracingInstance, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'tracing_instance_id' })
  tracingInstance!: TracingInstance;

  @Column({ type: 'text', array: true, default: '{}', name: 'service_names' })
  serviceNames!: string[];

  // Ownership tracking (RBAC Phase 2)
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
}
