import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * Per-user, per-card read mark for test-run comments (migration 1827). "Seen" means the
 * card's comments drawer was open: opening it upserts `lastSeenAt = now()` for that card only.
 * A missing row means every comment by others in the unread window is unread.
 */
@Entity('test_run_comment_reads')
export class TestRunCommentRead {
  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 255 })
  userId!: string;

  @PrimaryColumn({ name: 'test_run_id', type: 'uuid' })
  testRunId!: string;

  @PrimaryColumn({ name: 'card_key', type: 'varchar', length: 64 })
  cardKey!: string;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt!: Date;

  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;
}
