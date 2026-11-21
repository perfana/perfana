import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * Per-user read mark for one analysis story, shown in the UI as an investigation (migration 1834).
 * "Seen" means the reader opened it: `PUT /stories/:id/seen` upserts `lastSeenAt = now()`. A
 * missing row means never looked. Never exported with a SUT: read state is per user and per
 * environment, as for `test_run_comment_reads`.
 */
@Entity('test_run_story_reads')
@Index('idx_test_run_story_reads_story', ['storyId'])
export class TestRunStoryRead {
  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 255 })
  userId!: string;

  @PrimaryColumn({ name: 'story_id', type: 'uuid' })
  storyId!: string;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt!: Date;

  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;
}
