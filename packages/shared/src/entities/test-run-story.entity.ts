import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import type { StoryAuthorKind, StoryStatus } from '../constants/comment-cards';

/**
 * An analysis story on a test run (migration 1830; design: docs/designs/test-run-analysis-stories.md,
 * "Stories"): an ordered walk over the run's root comments, with a title and a conclusion. Steps
 * live in `test_run_story_steps` and reference comments; a story never copies a comment.
 *
 * A user's draft is visible to its author only; an agent's draft (migration 1833) and a published
 * story to anyone who can see the run. `publishedAt` is set on the first publish and kept on
 * unpublish; `publishedById` / `publishedByName` name whoever published it last.
 */
@Entity('test_run_stories')
@Index('idx_test_run_stories_run_created', ['testRunId', 'createdAt'])
export class TestRunStory {
  /**
   * Audited on delete only, like comments: a delete may be an org admin removing someone else's
   * published story, and the record keeps what it claimed (title and conclusion).
   */
  static auditableFields = ['testRunId', 'title', 'summary', 'status', 'authorId', 'authorName'] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The run's uuid primary key (`test_runs.id`), not the human `test_run_id`. */
  @Column({ name: 'test_run_id', type: 'uuid' })
  testRunId!: string;

  @Column({ name: 'title', type: 'varchar', length: 200 })
  title!: string;

  /** The conclusion, shown as the reader's last screen. */
  @Column({ name: 'summary', type: 'text', nullable: true })
  summary!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'draft' })
  status!: StoryStatus;

  @Column({ name: 'author_id', type: 'varchar', length: 255 })
  authorId!: string;

  @Column({ name: 'author_name', type: 'varchar', length: 255 })
  authorName!: string;

  /** 'agent' when an API key with `comments:write` created it (PR6b); never read from a request. */
  @Column({ name: 'author_kind', type: 'varchar', length: 16, default: 'user' })
  authorKind!: StoryAuthorKind;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  /**
   * Set when the notification sweep claims the published story for its channel announcement
   * (migration 1832). Never cleared by an unpublish, so a republish is not announced again.
   * Written by the sweep only.
   */
  @Column({ name: 'notified_at', type: 'timestamptz', nullable: true, select: false })
  notifiedAt?: Date | null;

  /** Retry backoff after a released announcement (migration 1832). Written by the sweep only. */
  @Column({ name: 'notify_after', type: 'timestamptz', nullable: true, select: false })
  notifyAfter?: Date | null;

  /**
   * Who published it last (migration 1833): set on every publish, kept on unpublish. For an
   * agent's story this is the person who reviewed it ("reviewed and published by").
   */
  @Column({ name: 'published_by_id', type: 'varchar', length: 255, nullable: true })
  publishedById!: string | null;

  @Column({ name: 'published_by_name', type: 'varchar', length: 255, nullable: true })
  publishedByName!: string | null;

  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
