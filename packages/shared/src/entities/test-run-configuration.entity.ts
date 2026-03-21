import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { TestRun } from './test-run.entity';

@Entity('test_run_configs')
export class TestRunConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'test_run_id', type: 'uuid', nullable: true })
  testRunId?: string;

  @Column('varchar')
  key!: string;

  @Column('text', { nullable: true })
  value?: string;

  @Column('text', { array: true, nullable: true })
  tags?: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'test_run_id_string', type: 'varchar', nullable: true })
  testRunIdString?: string;

  // Relationships
  @ManyToOne(() => TestRun, testRun => testRun.configurations)
  @JoinColumn({ name: 'test_run_id' })
  testRun!: TestRun;
}