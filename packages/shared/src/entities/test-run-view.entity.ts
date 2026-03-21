import { Entity, Column, ManyToOne, JoinColumn, PrimaryColumn, Index } from 'typeorm';
import { TestRun } from './test-run.entity';

@Entity('test_run_views')
@Index('idx_test_run_views_user_id', ['userId'])
@Index('idx_test_run_views_test_run_id', ['testRunId'])
export class TestRunView {
  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 255 })
  userId!: string;

  @PrimaryColumn({ name: 'test_run_id', type: 'uuid' })
  testRunId!: string;

  @Column({ name: 'viewed_at', type: 'timestamptz', default: () => 'NOW()' })
  viewedAt!: Date;

  @ManyToOne(() => TestRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'test_run_id' })
  testRun!: TestRun;
}
